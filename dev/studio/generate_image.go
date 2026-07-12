package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
	"github.com/OpenRouterTeam/go-sdk/models/operations"
)

func generateImage(ctx context.Context, client *openrouter.OpenRouter, modelID, prompt string, refs []refImage, p genParams) (genResult, error) {
	req := components.ImageGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
	}
	if len(refs) > 0 {
		// image-to-image: forward every uploaded reference. The SDK accepts a
		// list, and the cap is enforced in handleGenerate.
		req.InputReferences = make([]components.ContentPartImage, 0, len(refs))
		for _, ref := range refs {
			req.InputReferences = append(req.InputReferences, components.ContentPartImage{
				Type:     components.ContentPartImageTypeImageURL,
				ImageURL: components.ContentPartImageImageURL{URL: ref.dataURL()},
			})
		}
	}

	// Optional params. Each helper returns nil for "blank", which the SDK
	// omits from the request body via `omitzero`.
	if v := p.AspectRatio; v != "" {
		req.AspectRatio = (*components.ImageGenerationRequestAspectRatio)(&v)
	}
	if v := p.Background; v != "" {
		req.Background = (*components.ImageGenerationRequestBackground)(&v)
	}
	if v := p.OutputFormat; v != "" {
		req.OutputFormat = (*components.ImageGenerationRequestOutputFormat)(&v)
	}
	if v := p.Quality; v != "" {
		req.Quality = (*components.ImageGenerationRequestQuality)(&v)
	}
	if v := p.Resolution; v != "" {
		req.Resolution = (*components.ImageGenerationRequestResolution)(&v)
	}
	req.N = int64Ptr(p.N)
	req.OutputCompression = int64Ptr(p.OutputCompression)
	req.Seed = int64Ptr(p.Seed)

	resp, err := client.Images.Generate(ctx, req, operations.WithOperationTimeout(2*time.Minute))
	if err != nil {
		return genResult{}, err
	}
	if resp == nil || resp.ImageGenerationResponse == nil || len(resp.ImageGenerationResponse.Data) == 0 {
		return genResult{}, fmt.Errorf("no image data in response")
	}

	img := resp.ImageGenerationResponse.Data[0]
	bytes, err := base64.StdEncoding.DecodeString(img.B64JSON)
	if err != nil {
		return genResult{}, fmt.Errorf("decode b64_json: %w", err)
	}

	ext := "png"
	// Trust the SDK's declared media type if present.
	if mt := img.GetMediaType(); mt != nil {
		switch *mt {
		case "image/jpeg":
			ext = "jpg"
		case "image/webp":
			ext = "webp"
		case "image/svg+xml":
			ext = "svg"
		}
	}
	// Defense in depth: verify the actual bytes match the claimed format.
	// If they don't (truncated payload, model returned a different format
	// than it claimed, etc.), the user would get a corrupt file on disk.
	// Cross-check the bytes and override `ext` only if the SDK's claim is
	// definitely wrong.
	if sniffed := sniffImageExt(bytes); sniffed != "" {
		if ext != sniffed {
			fmt.Fprintf(os.Stderr, "warning: image model=%s declared %q but bytes look like %q; using %q\n",
				modelID, ext, sniffed, sniffed)
			ext = sniffed
		}
	} else {
		// Bytes don't look like any known image. Surface a clear error
		// instead of writing garbage to disk.
		return genResult{}, fmt.Errorf("decoded image bytes do not look like a known image format (first %d bytes: % x)", min(len(bytes), 16), bytes[:min(len(bytes), 16)])
	}
	return genResult{ext: ext, data: bytes}, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
